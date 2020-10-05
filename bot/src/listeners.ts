import eris, { Emoji, PossiblyUncachedMessage } from "eris";
import { createEmptyNewSession, movePlayersToSilenceChannel, movePlayersToTalkingChannel } from "./actions";
import { COLOR_EMOTE_IDS, GROUPING_TOGGLE_EMOJI, LEAVE_EMOJI, LobbyRegion, SessionState } from "./constants";
import { orm } from "./database";
import AmongUsSession from "./database/among-us-session";
import SessionChannel, { SILENCE_CHANNELS, TALKING_CHANNELS } from "./database/session-channel";
import startSession, { getRunnerForSession } from "./session-runner";

const COMMAND_PREFIX = "!amongus ";
const VOICE_CHANNEL_USERS = new Map<string, string[]>();
const ADMIN_USERS = new Set<string>();

/**
 * Helper function that ensures that ADMIN_USERS is updated based on
 * whether or not the specified member is an administrator or server owner.
 */
function updateAdminUserState(member: eris.Member) {
    const isAdmin =
        member.roles.some(x => member.guild.roles.get(x)!.permissions.has("administrator")) ||
        member.guild.ownerID === member.id;

    if (isAdmin) {
        ADMIN_USERS.add(member.id);
    } else {
        ADMIN_USERS.delete(member.id);
    }
}

/**
 * Invoked when the specified member joins the specified new voice channel.
 * Responsible for tracking voice channel membership, as well as ensuring
 * that anyone joining the current talking voice channel while the game is
 * in progress will automatically be redirected to the silence channel.
 */
export async function onVoiceJoin(member: eris.Member, newChannel: eris.VoiceChannel) {
    updateAdminUserState(member);
    VOICE_CHANNEL_USERS.set(newChannel.id, [...(VOICE_CHANNEL_USERS.get(newChannel.id) || []), member.id]);

    // Check if this is a game voice channel and we're in game right now.
    const relevantChannel = await orm.em.findOne(
        SessionChannel,
        {
            channelId: newChannel.id,
        },
        ["session"]
    );

    if (!relevantChannel) return;

    // If this is a talking channel and we're playing, move them to the playing channel.
    if (TALKING_CHANNELS.includes(relevantChannel.type) && relevantChannel.session.state === SessionState.PLAYING) {
        await movePlayersToSilenceChannel(member.guild.shard.client, relevantChannel.session);
    }

    // If this is a playing channel and we're talking, move them to the talking channel.
    if (SILENCE_CHANNELS.includes(relevantChannel.type) && relevantChannel.session.state !== SessionState.PLAYING) {
        await movePlayersToTalkingChannel(member.guild.shard.client, relevantChannel.session);
    }
}

/**
 * Invoked when the specified member leaves the specified channel.
 */
export async function onVoiceLeave(member: eris.Member, oldChannel: eris.VoiceChannel) {
    updateAdminUserState(member);
    const users = VOICE_CHANNEL_USERS.get(oldChannel.id);
    if (!users) return;

    const idx = users.indexOf(member.id);
    if (idx === -1) return;

    users.splice(idx, 1);
}

/**
 * Invoked when the specified member moves from the oldChannel to the
 * newChannel. Simply invokes onVoiceLeave and onVoiceJoin.
 */
export async function onVoiceChange(member: eris.Member, newChannel: eris.VoiceChannel, oldChannel: eris.VoiceChannel) {
    await onVoiceLeave(member, oldChannel);
    await onVoiceJoin(member, newChannel);
}

/**
 * Helper function that returns the list of user ids currently in the
 * specified voice channel, or an empty list if there are none.
 */
export function getMembersInChannel(channel: string): string[] {
    return VOICE_CHANNEL_USERS.get(channel) || [];
}

/**
 * Returns whether or not the specified user ID is an administrator.
 */
export function isMemberAdmin(id: string): boolean {
    return ADMIN_USERS.has(id);
}

/**
 * Invoked when a reaction is added to any message. We will use it to process
 * player links.
 */
export async function onReactionAdded(
    bot: eris.Client,
    message: PossiblyUncachedMessage,
    emoji: Emoji,
    userID: string
) {
    if (
        !COLOR_EMOTE_IDS.includes(emoji.id) &&
        GROUPING_TOGGLE_EMOJI.split(":")[1] !== emoji.id &&
        LEAVE_EMOJI.split(":")[1] !== emoji.id
    )
        return;

    if (userID === bot.user.id) return;

    const session = await orm.em.findOne(AmongUsSession, {
        message: message.id,
    });
    if (!session) return;

    // Remove the reaction.
    await bot
        .removeMessageReaction(message.channel.id, message.id, emoji.name + ":" + emoji.id, userID)
        .catch(() => {});

    // Attempt to forward it to the session runner.
    const runner = getRunnerForSession(session);
    if (runner) {
        await runner.handleEmojiSelection(emoji.id, userID);
    }
}

/**
 * Invoked when a new message is created in a channel shared by the bot.
 * Will attempt to parse the message as a command, and handle appropriately.
 */
export async function onMessageCreated(bot: eris.Client, msg: eris.Message) {
    if (!msg.content.startsWith(COMMAND_PREFIX) || msg.author.bot) return;
    if (!(msg.channel instanceof eris.TextChannel)) return;

    try {
        const { region, code } = parseCommandInvocation(msg.content);

        const session = await createEmptyNewSession(msg, region, code);
        await startSession(bot, session);
    } catch (e) {
        await msg.channel.createMessage(`<@!${msg.author.id}>, sorry but something went wrong: ${e}`).catch(() => {});
    }
}

/**
 * Attempts to parse the region from the specified command invocation,
 * including the command prefix. Returns the parsed region and the code,
 * or throws an error if it could not be parsed.
 */
function parseCommandInvocation(msg: string): { region: LobbyRegion; code: string } {
    msg = msg.slice(COMMAND_PREFIX.length);

    let region: LobbyRegion | null = null;

    const nextWord = msg.slice(0, msg.indexOf(" ")).toLowerCase();

    if (nextWord === "asia" || nextWord === "as") {
        region = LobbyRegion.ASIA;
        msg = msg.slice(nextWord.length);
    }

    if (nextWord === "eu" || nextWord === "europe") {
        region = LobbyRegion.EUROPE;
        msg = msg.slice(nextWord.length);
    }

    if (
        nextWord === "us" ||
        nextWord === "usa" ||
        nextWord === "na" ||
        nextWord === "america" ||
        nextWord === "northamerica"
    ) {
        region = LobbyRegion.NORTH_AMERICA;
        msg = msg.slice(nextWord.length);
    }

    if (nextWord === "north") {
        msg = msg.slice(nextWord.length).trim().toLowerCase();

        const nextNextWord = msg.slice(0, msg.indexOf(" "));
        if (nextNextWord === "america") {
            region = LobbyRegion.NORTH_AMERICA;
            msg = msg.slice(nextNextWord.length);
        }
    }

    if (!region) {
        throw (
            "Could not determine the region of the lobby. Try doing `" +
            COMMAND_PREFIX +
            "na ABCDEF` or `" +
            COMMAND_PREFIX +
            "europe GHIJKL`."
        );
    }

    return {
        region,
        code: validateLobbyCode(msg),
    };
}

// Valid chars in a V2 (6-character) Among Us lobby code.
const V2 = "QWXRTYLPESDFGHUJKZOCVBINMA";

/**
 * Verifies the specified string as a lobby code. If it is valid, returns
 * the code. Else, throws an error.
 */
function validateLobbyCode(code: string) {
    code = code.trim().toUpperCase();

    if (code.length !== 6) {
        throw "Invalid lobby code. The lobby code must be exactly 6 letters.";
    }

    if ([...code].some(x => !V2.includes(x))) {
        throw "Invalid lobby code. The lobby code contains invalid characters.";
    }

    return code;
}
