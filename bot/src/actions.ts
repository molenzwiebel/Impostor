import eris from "eris";
import { LobbyRegion, SessionState } from "./constants";
import { orm } from "./database";
import AmongUsSession from "./database/among-us-session";
import { SessionChannelType } from "./database/session-channel";

const LOADING = 0x36393f;
const INFO = 0x0a96de;
const ERROR = 0xfd5c5c;
const WARN = 0x0;

export async function createEmptyNewSession(
    msg: eris.Message,
    region: LobbyRegion,
    code: string
): Promise<AmongUsSession> {
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
    session.state = SessionState.LOBBY;
    session.region = region;
    session.lobbyCode = code;
    await orm.em.persist(session);
    await orm.em.flush();

    return session;
}

export async function updateMessageWithError(bot: eris.Client, session: AmongUsSession, error: string) {
    await bot.editMessage(session.channel, session.message, {
        embed: {
            color: ERROR,
            title: `🎲 Among Us - Error`,
            description: `${error}`,
        },
    });
}

export async function updateMessageWithSessionOver(bot: eris.Client, session: AmongUsSession) {
    await bot.editMessage(session.channel, session.message, {
        embed: {
            color: ERROR,
            title: `🎲 Among Us - Session Over`,
            description: `${session.user} was hosting a game of [Among Us](http://www.innersloth.com/gameAmongUs.php) here, but the lobby closed.`,
        },
    });
}

export async function updateMessage(bot: eris.Client, session: AmongUsSession) {
    if (session.state === SessionState.LOBBY) {
        await updateMessageToLobby(bot, session);
    }
}

async function updateMessageToLobby(bot: eris.Client, session: AmongUsSession) {
    await session.channels.init();
    const mainChannel = session.channels.getItems().find(x => x.type === SessionChannelType.TALKING)!;

    await bot.editMessage(session.channel, session.message, {
        embed: {
            color: INFO,
            title: `🎲 Among Us - ${session.region} - ${session.lobbyCode}`,
            description: `${session.user} is hosting a game of [Among Us](http://www.innersloth.com/gameAmongUs.php)! Join the voice channel <#${mainChannel.channelId}> or click [here](https://discord.gg/${mainChannel.invite}) to join the voice chat. To join the Among Us lobby, select the **${session.region}** server and enter code \`${session.lobbyCode}\`.`,
            footer: {
                icon_url:
                    "https://cdn.discordapp.com/icons/579772930607808537/2d2607a672f2529206edd929ef55173e.png?size=128",
                text: "Reminder: the bot takes up a player spot!",
            },
        },
    });
}
