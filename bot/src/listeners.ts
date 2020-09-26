import eris from "eris";
import { createEmptyNewSession } from "./actions";
import { LobbyRegion, SessionState } from "./constants";
import { orm } from "./database";
import SessionChannel, { SessionChannelType } from "./database/session-channel";
import startSession from "./session-runner";

const COMMAND_PREFIX = "!amongus ";
const VOICE_CHANNEL_USERS = new Map<string, string[]>();

/**
 * Invoked when the specified member joins the specified new voice channel.
 * Responsible for tracking voice channel membership, as well as ensuring
 * that anyone joining the current talking voice channel while the game is
 * in progress will automatically be redirected to the silence channel.
 */
export async function onVoiceJoin(member: eris.Member, newChannel: eris.VoiceChannel) {
    VOICE_CHANNEL_USERS.set(newChannel.id, [...(VOICE_CHANNEL_USERS.get(newChannel.id) || []), member.id]);

    // Check if this is a game voice channel and we're in game right now.
    const relevantChannel = await orm.em.findOne(
        SessionChannel,
        {
            channelId: newChannel.id,
            type: SessionChannelType.TALKING,
        },
        ["session"]
    );

    if (!relevantChannel) return;

    // We're in game, move them to the silence channel.
    if (relevantChannel.session.state === SessionState.PLAYING) {
        await relevantChannel.session.channels.init();
        const playingChannel = relevantChannel.session.channels
            .getItems()
            .find(x => x.type === SessionChannelType.SILENCE)!;

        await member.guild.editMember(member.id, {
            channelID: playingChannel.channelId,
        });
    }
}

/**
 * Invoked when the specified member leaves the specified channel.
 */
export async function onVoiceLeave(member: eris.Member, oldChannel: eris.VoiceChannel) {
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
