import child_process from "child_process";
import eris from "eris";
import path from "path";
import {
    movePlayersToSilenceChannel,
    movePlayersToTalkingChannel,
    updateMessage,
    updateMessageWithError,
    updateMessageWithSessionOver,
} from "./actions";
import { SERVER_IPS, SessionState } from "./constants";
import { orm } from "./database";
import AmongUsSession from "./database/among-us-session";
import SessionChannel, { SessionChannelType } from "./database/session-channel";

const WORKING_DIR = path.resolve(path.join(__dirname, "../../client/bin/Debug/netcoreapp3.1"));
const CLIENT = path.join(WORKING_DIR, "client.exe");

/**
 * Class that handles all communication with the AU client in C#, using
 * JSON messages passed over the standard out to receive data from the client.
 */
class SessionRunner {
    private process: child_process.ChildProcess;
    private isConnected = false;

    constructor(private bot: eris.Client, private session: AmongUsSession) {}

    /**
     * Starts this session, launching the client and attempting to connect to
     * the relevant lobby, as configured in the session.
     */
    public async start() {
        this.process = child_process.spawn(CLIENT, [SERVER_IPS[this.session.region], this.session.lobbyCode], {
            cwd: WORKING_DIR,
        });

        this.process.stdout!.setEncoding("utf-8");
        this.process.stdout!.on("data", this.handleClientStdout);
        this.process.stdout!.on("close", () => this.handleDisconnect());
    }

    /**
     * Invoked when the client disconnects, such as when the lobby closes.
     * Should handle removal of the session and channels.
     */
    private async handleDisconnect() {
        if (!this.isConnected) return;

        this.isConnected = false;

        await this.session.channels.init();
        for (const channel of this.session.channels) {
            await this.bot.deleteChannel(channel.channelId, "Among Us: Session is over.");
        }

        await updateMessageWithSessionOver(this.bot, this.session);
        await orm.em.removeAndFlush(this.session);
    }

    /**
     * Invoked when the client encounters an error during startup. This
     * does not need to handle removal of channels, as they aren't created
     * yet.
     */
    private async handleError(error: string) {
        await updateMessageWithError(this.bot, this.session, error);
        await orm.em.removeAndFlush(this.session);
    }

    /**
     * Invoked when the client successfully joins the lobby indicated in the
     * current session. Creates the relevant voice channels and updates the state.
     */
    private async handleConnect() {
        if (this.isConnected) return;

        const category = await this.bot.createChannel(
            this.session.guild,
            "Among Us",
            4,
            "Among Us: Create category for voice channels."
        );
        this.session.channels.add(new SessionChannel(category.id, SessionChannelType.CATEGORY));

        const talkingChannel = await this.bot.createChannel(this.session.guild, "Among Us - Discussion", 2, {
            parentID: category.id,
        });

        const talkingInvite = await talkingChannel.createInvite({
            unique: true,
        });

        this.session.channels.add(
            new SessionChannel(talkingChannel.id, SessionChannelType.TALKING, talkingInvite.code)
        );

        const mutedChannel = await this.bot.createChannel(this.session.guild, "Among Us - Playing", 2, {
            parentID: category.id,
            permissionOverwrites: [
                {
                    type: "role",
                    id: this.session.guild,
                    deny: eris.Constants.Permissions.voiceSpeak,
                    allow: 0,
                },
            ],
        });
        this.session.channels.add(new SessionChannel(mutedChannel.id, SessionChannelType.SILENCE));

        this.isConnected = true;
        await this.setStateTo(SessionState.LOBBY);
    }

    /**
     * Simple method that changes the current state of the lobby to the specified
     * state, then ensures that the chat message is updated to reflect this state.
     */
    private async setStateTo(state: SessionState) {
        this.session.state = state;
        await orm.em.flush();
        await updateMessage(this.bot, this.session);
    }

    /**
     * Receives and handles output from the client, parsing the result into
     * a JSON message and then dispatching the result of that message.
     */
    private handleClientStdout = async (msg: string) => {
        const { type, ...rest } = JSON.parse(msg);

        if (type === "connect") {
            await this.handleConnect();
        }

        if (type === "gameEnd") {
            await this.setStateTo(SessionState.LOBBY);
            await movePlayersToTalkingChannel(this.bot, this.session);
        }

        if (type === "talkingStart") {
            await this.setStateTo(SessionState.DISCUSSING);
            await movePlayersToTalkingChannel(this.bot, this.session);
        }

        if (type === "talkingEnd") {
            await this.setStateTo(SessionState.PLAYING);
            await movePlayersToSilenceChannel(this.bot, this.session);
        }

        if (type === "disconnect") {
            await this.handleDisconnect();
        }

        if (type === "error") {
            await this.handleError(rest.message);
        }
    };
}

/**
 * Creates a new client instance for the specified AmongUsSession, causing
 * it to connect to the lobby and handle events. This method should never
 * directly throw.
 */
export default async function startSession(bot: eris.Client, session: AmongUsSession) {
    const runner = new SessionRunner(bot, session);
    await runner.start();
}
