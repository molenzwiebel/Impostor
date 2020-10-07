import eris from "eris";
import {
    COLOR_EMOTES,
    DEAD_COLOR_EMOTES,
    GROUPING_DISABLED_EMOJI,
    GROUPING_ENABLED_EMOJI,
    GROUPING_TOGGLE_EMOJI,
    LEAVE_EMOJI,
    LobbyRegion,
    SessionState,
} from "./constants";
import { orm } from "./database";
import AmongUsSession from "./database/among-us-session";
import SessionChannel, {
    MUTE_IF_DEAD_CHANNELS,
    SessionChannelType,
    SILENCE_CHANNELS,
} from "./database/session-channel";
import { getMembersInChannel, isMemberAdmin } from "./listeners";
import { getRunnerForSession, PlayerData, PlayerDataFlags } from "./session-runner";

const LOADING = 0x36393f;
const INFO = 0x0a96de;
const ERROR = 0xfd5c5c;
const WARN = 0xed872d;

/**
 * Creates a new loading message as response to the specified message
 * and creates a new empty session with the specified region and code.
 * The session does not start automatically and needs to be started using
 * the session runner.
 */
export async function createEmptyNewSession(
    msg: eris.Message,
    region: LobbyRegion,
    code: string
): Promise<AmongUsSession> {
    console.log(`[+] Creating new AU session for ${code} on ${region}`);

    const message = await msg.channel.createMessage({
        embed: {
            color: LOADING,
            description: `<a:loading:572067799535452171> Attempting to connect to lobby \`${code}\` on ${region}...`,
        },
    });

    // Create a new session.
    const session = new AmongUsSession();
    session.guild = (msg.channel as eris.TextChannel).guild.id;
    session.channel = msg.channel.id;
    session.message = message.id;
    session.user = msg.author.username;
    session.creator = msg.author.id;
    session.state = SessionState.LOBBY;
    session.region = region;
    session.lobbyCode = code;
    session.groupImpostors = false;
    await orm.em.persist(session);
    await orm.em.flush();

    return session;
}

/**
 * Helper function that queries all stale sessions currently in the database
 * and ensures that they are cleaned up. No attempt is done at reconnecting
 * to the server.
 */
export async function cleanUpOldSessions(bot: eris.Client) {
    const sessions = await orm.em.find(AmongUsSession, {}, ["channels"]);
    for (const session of sessions) {
        await cleanUpSession(bot, session);
    }
}

/**
 * Similar to cleanUpOldSessions, but for a single old session.
 */
async function cleanUpSession(bot: eris.Client, session: AmongUsSession) {
    await session.channels.init();
    for (const channel of session.channels) {
        await bot.deleteChannel(channel.channelId, "Among Us: Session is over.");
    }

    await updateMessageWithSessionStale(bot, session);
    await orm.em.removeAndFlush(session);
}

/**
 * Moves all players in `idFrom` to `idTo`.
 */
async function moveAllPlayers(bot: eris.Client, session: AmongUsSession, idFrom: string, idTo: string) {
    await Promise.all(
        getMembersInChannel(idFrom).map(x =>
            bot.editGuildMember(session.guild, x, {
                channelID: idTo,
            })
        )
    );
}

/**
 * Moves all players currently in the silence channels of the given
 * among us session to the relevant talking channel.
 */
export async function movePlayersToTalkingChannel(bot: eris.Client, session: AmongUsSession) {
    await session.channels.init();

    const talkingChannel = session.channels.getItems().find(x => x.type === SessionChannelType.TALKING)!;
    const silenceChannels = session.channels.getItems().filter(x => SILENCE_CHANNELS.includes(x.type));

    await Promise.all(silenceChannels.map(x => moveAllPlayers(bot, session, x.channelId, talkingChannel.channelId)));
}

/**
 * Moves all players currently in the talking channel of the given
 * among us session to the relevant silence channel.
 */
export async function movePlayersToSilenceChannel(bot: eris.Client, session: AmongUsSession) {
    if (session.groupImpostors) {
        await movePlayersToSilenceChannelGrouped(bot, session);
    } else {
        await movePlayersToSilenceChannelUngrouped(bot, session);
    }
}

/**
 * Moves all players currently in the talking channel to a common
 * silence channel, except for any admins in the call, which get their
 * own channel.
 */
export async function movePlayersToSilenceChannelUngrouped(bot: eris.Client, session: AmongUsSession) {
    await session.channels.init();

    const categoryChannel = session.channels.getItems().find(x => x.type === SessionChannelType.CATEGORY)!;
    const talkingChannel = session.channels.getItems().find(x => x.type === SessionChannelType.TALKING)!;
    const silenceChannel = session.channels.getItems().find(x => x.type === SessionChannelType.SILENCE)!;

    const playersInTalkingChannel = getMembersInChannel(talkingChannel.channelId);
    const normalPlayersInTalkingChannel = playersInTalkingChannel.filter(x => !isMemberAdmin(x));

    // Figure out which admin players need to get their own channel.
    const adminPlayersInTalkingChannel = playersInTalkingChannel.filter(isMemberAdmin);
    const emptyAdminChannels = session.channels
        .getItems()
        .filter(x => x.type === SessionChannelType.ADMIN_SILENCE && getMembersInChannel(x.channelId).length === 0);

    for (const adminId of adminPlayersInTalkingChannel) {
        const appropriateAdminChannel = emptyAdminChannels.pop();

        if (appropriateAdminChannel) {
            await bot.editGuildMember(session.guild, adminId, {
                channelID: appropriateAdminChannel.channelId,
            });
            continue;
        }

        // We need to create an admin channel for this user.
        try {
            bot.getDMChannel(adminId).then(channel =>
                channel.createMessage(
                    `Hey there <@!${adminId}>! Since you're an administrator, I can't mute you through channel permissions. As such, I've created a special Muted channel just for you!`
                )
            );
        } catch (e) {
            // ignore
        }

        const adminChannel = await bot.createChannel(session.guild, "Muted (Admin)", 2, {
            parentID: categoryChannel.channelId,
            permissionOverwrites: [
                {
                    type: "role",
                    id: session.guild,
                    deny: eris.Constants.Permissions.voiceSpeak | eris.Constants.Permissions.readMessages,
                    allow: 0,
                },
            ],
        });
        session.channels.add(new SessionChannel(adminChannel.id, SessionChannelType.ADMIN_SILENCE));

        await bot.editGuildMember(session.guild, adminId, {
            channelID: adminChannel.id,
        });
    }

    await orm.em.persistAndFlush(session);

    // Move the normal players.
    await Promise.all(
        normalPlayersInTalkingChannel.map(id =>
            bot.editGuildMember(session.guild, id, {
                channelID: silenceChannel.channelId,
            })
        )
    );
}

/**
 * Moves all players currently in the talking channel to their own silence
 * channel, except the players that
 */
export async function movePlayersToSilenceChannelGrouped(bot: eris.Client, session: AmongUsSession) {
    await session.channels.init();
    await session.links.init();

    const runner = getRunnerForSession(session);
    if (!runner) return;

    const categoryChannel = session.channels.getItems().find(x => x.type === SessionChannelType.CATEGORY)!;
    const talkingChannel = session.channels.getItems().find(x => x.type === SessionChannelType.TALKING)!;
    const impostorChannel = session.channels.getItems().find(x => x.type === SessionChannelType.IMPOSTORS)!;
    const impostorSnowflakes = session.links
        .getItems()
        .filter(x => runner.isImpostor(x.clientId))
        .map(x => x.snowflake);

    const playersInTalkingChannel = getMembersInChannel(talkingChannel.channelId);
    const impostorsInTalkingChannel = playersInTalkingChannel.filter(x => impostorSnowflakes.includes(x));
    const normalPlayersInTalkingChannel = playersInTalkingChannel.filter(x => !impostorSnowflakes.includes(x));

    // Move impostors to the impostor channel.
    for (const impostorId of impostorsInTalkingChannel) {
        await bot.editGuildMember(session.guild, impostorId, {
            channelID: impostorChannel.channelId,
        });
    }

    // Move normal players to empty channels, or create if there are not enough.
    const emptySilenceChannels = session.channels
        .getItems()
        .filter(
            x => x.type === SessionChannelType.SINGLE_PLAYER_SILENCE && getMembersInChannel(x.channelId).length === 0
        );

    for (const user of normalPlayersInTalkingChannel) {
        const appropriateChannel = emptySilenceChannels.pop();

        if (appropriateChannel) {
            await bot.editGuildMember(session.guild, user, {
                channelID: appropriateChannel.channelId,
            });
            continue;
        }

        // We need to create a silence channel for this user.
        const silenceChannel = await bot.createChannel(session.guild, "Muted", 2, {
            parentID: categoryChannel.channelId,
            permissionOverwrites: [
                {
                    type: "role",
                    id: session.guild,
                    deny: eris.Constants.Permissions.voiceSpeak | eris.Constants.Permissions.readMessages,
                    allow: 0,
                },
            ],
        });
        session.channels.add(new SessionChannel(silenceChannel.id, SessionChannelType.SINGLE_PLAYER_SILENCE));

        await bot.editGuildMember(session.guild, user, {
            channelID: silenceChannel.id,
        });
    }

    await orm.em.persistAndFlush(session);
}

/**
 * Mutes the specified player in all channels where people can normally talk.
 */
export async function mutePlayerInChannels(bot: eris.Client, session: AmongUsSession, snowflake: string) {
    await session.channels.init();

    for (const channel of session.channels.getItems().filter(x => MUTE_IF_DEAD_CHANNELS.includes(x.type))) {
        await bot.editChannelPermission(
            channel.channelId,
            snowflake,
            0,
            eris.Constants.Permissions.voiceSpeak,
            "member"
        );
    }
}

/**
 * Unmutes the specified player from all channels where people can normally talk.
 */
export async function unmutePlayerInChannels(bot: eris.Client, session: AmongUsSession, snowflake: string) {
    await session.channels.init();

    for (const channel of session.channels.getItems().filter(x => MUTE_IF_DEAD_CHANNELS.includes(x.type))) {
        await bot.deleteChannelPermission(channel.channelId, snowflake);
    }
}

/**
 * Updates the message of the specified session with the notion
 * that an error occurred during connecting. Does not remove the
 * session itself.
 */
export async function updateMessageWithError(bot: eris.Client, session: AmongUsSession, error: string) {
    await bot.editMessage(session.channel, session.message, {
        embed: {
            color: ERROR,
            title: `🎲 Among Us - Error`,
            description: `${error}`,
        },
    });

    await bot.removeMessageReactions(session.channel, session.message);
}

/**
 * Updates the message of the specified session with the notion
 * that the session is over because the lobby was closed. Does not
 * remove the session itself.
 */
export async function updateMessageWithSessionOver(bot: eris.Client, session: AmongUsSession) {
    await bot.editMessage(session.channel, session.message, {
        embed: {
            color: ERROR,
            title: `🎲 Among Us - Session Over`,
            description: `${session.user} was hosting a game of [Among Us](http://www.innersloth.com/gameAmongUs.php) here, but the lobby closed.`,
        },
    });

    await bot.removeMessageReactions(session.channel, session.message);
}

/**
 * Updates the message of the specified session with the notion
 * that the session is over because the bot restarted during the
 * game and was not able to reconnect.
 */
export async function updateMessageWithSessionStale(bot: eris.Client, session: AmongUsSession) {
    await bot.editMessage(session.channel, session.message, {
        embed: {
            color: ERROR,
            title: `🎲 Among Us - Session Over`,
            description: `${session.user} was hosting a game of [Among Us](http://www.innersloth.com/gameAmongUs.php) here, but an unexpected error happened. Try again in a bit?`,
        },
    });

    await bot.removeMessageReactions(session.channel, session.message);
}

/**
 * Adds all the different crewmate color reactions to the message created by
 * the bot, so that players can associate themselves with an ingame player.
 */
export async function addMessageReactions(bot: eris.Client, session: AmongUsSession) {
    await bot.addMessageReaction(session.channel, session.message, GROUPING_TOGGLE_EMOJI);
    await bot.addMessageReaction(session.channel, session.message, LEAVE_EMOJI);

    for (const emote of Object.values(COLOR_EMOTES)) {
        await bot.addMessageReaction(session.channel, session.message, emote);
    }
}

/**
 * Updates the message for the specified among us session to the
 * relevant content for the current session state. Should be invoked
 * after the state of the session was changed.
 */
export async function updateMessage(bot: eris.Client, session: AmongUsSession, playerData: PlayerData[]) {
    if (session.state === SessionState.LOBBY) {
        await updateMessageToLobby(bot, session, playerData);
    }

    if (session.state === SessionState.PLAYING || session.state === SessionState.DISCUSSING) {
        await updateMessageToPlaying(bot, session, playerData);
    }
}

/**
 * Formats the list of players currently in the specified session, using
 * the game data from the current session.
 */
function formatPlayerText(session: AmongUsSession, playerData: PlayerData[]) {
    let playerText = "";
    for (const p of playerData) {
        const emoteMap = (p.statusBitField & PlayerDataFlags.DEAD) === 0 ? COLOR_EMOTES : DEAD_COLOR_EMOTES;
        playerText += `<:${emoteMap[p.color]}> ${p.name}`;

        const links = session.links.getItems().filter(x => x.clientId === "" + p.clientId);
        if (links.length) {
            playerText += ` (` + links.map(x => `<@!${x.snowflake}>`).join(", ") + `)`;
        }

        playerText += "\n";
    }
    return playerText.trim();
}

/**
 * Updates the message of the specified session to the content that
 * the match is currently ongoing.
 */
async function updateMessageToPlaying(bot: eris.Client, session: AmongUsSession, playerData: PlayerData[]) {
    await session.channels.init();
    const mainChannel = session.channels.getItems().find(x => x.type === SessionChannelType.TALKING)!;

    const groupingText = session.groupImpostors
        ? `Impostors will be put in a shared voice channel and will be able to communicate during the game. Normal players will not be able to see who the impostors are. ${session.user} can react with <:${GROUPING_TOGGLE_EMOJI}> **after this round is over** to disable this.`
        : `Want an extra challenge? Impostors can be automatically put in the same voice channel to allow them to communicate during the game. This will not reveal to the other players who the impostors are. ${session.user} can react with <:${GROUPING_TOGGLE_EMOJI}> **after this round is over** to enable this.`;

    await bot.editMessage(session.channel, session.message, {
        embed: {
            color: WARN,
            title: `🎲 Among Us - ${session.region} - ${session.lobbyCode} (In Game)`,
            description: `${session.user} is hosting a game of [Among Us](http://www.innersloth.com/gameAmongUs.php)! Join the voice channel <#${mainChannel.channelId}> or click [here](https://discord.gg/${mainChannel.invite}) to join the voice chat. ~~To join the Among Us lobby, select the **${session.region}** server and enter code \`${session.lobbyCode}\`.~~ The lobby is currently ongoing! You'll need to wait for the round to end before you can join.`,
            fields: [
                {
                    name: "Current Players",
                    value: formatPlayerText(session, playerData) || "_None_",
                },
                {
                    name: session.groupImpostors
                        ? GROUPING_ENABLED_EMOJI + " Impostors Are Grouped"
                        : GROUPING_DISABLED_EMOJI + " Impostors Not Grouped",
                    value: groupingText,
                },
            ],
            footer: {
                icon_url: bot.user.avatarURL.replace("jpg", "png"),
                text:
                    "Reminder: the bot takes up a player spot! Found that last player? Use the X to have the bot leave.",
            },
        },
    });
}

/**
 * Updates the message of the specified session to the content that the
 * session is currently in the lobby and that players are free to join.
 */
async function updateMessageToLobby(bot: eris.Client, session: AmongUsSession, playerData: PlayerData[]) {
    await session.channels.init();
    await session.links.init();
    const mainChannel = session.channels.getItems().find(x => x.type === SessionChannelType.TALKING)!;

    const groupingText = session.groupImpostors
        ? `Impostors will be put in a shared voice channel and will be able to communicate during the game. Normal players will not be able to see who the impostors are. ${session.user} can react with <:${GROUPING_TOGGLE_EMOJI}> to disable this.`
        : `Want an extra challenge? Impostors can be automatically put in the same voice channel to allow them to communicate during the game. This will not reveal to the other players who the impostors are. ${session.user} can react with <:${GROUPING_TOGGLE_EMOJI}> to enable this.`;

    await bot.editMessage(session.channel, session.message, {
        embed: {
            color: INFO,
            title: `🎲 Among Us - ${session.region} - ${session.lobbyCode}`,
            description: `${session.user} is hosting a game of [Among Us](http://www.innersloth.com/gameAmongUs.php)! Join the voice channel <#${mainChannel.channelId}> or click [here](https://discord.gg/${mainChannel.invite}) to join the voice chat. To join the Among Us lobby, select the **${session.region}** server and enter code \`${session.lobbyCode}\`.\n\nReact with your color to associate your Discord with your Among Us character! This will automatically mute you once you die and group you together with the other impostors if enabled.`,
            fields: [
                {
                    name: "Current Players",
                    value: formatPlayerText(session, playerData) || "_None_",
                },
                {
                    name: session.groupImpostors
                        ? GROUPING_ENABLED_EMOJI + " Impostors Are Grouped"
                        : GROUPING_DISABLED_EMOJI + " Impostors Not Grouped",
                    value: groupingText,
                },
            ],
            footer: {
                icon_url: bot.user.avatarURL.replace("jpg", "png"),
                text:
                    "Reminder: the bot takes up a player spot! Found that last player? Use the X to have the bot leave.",
            },
        },
    });
}
