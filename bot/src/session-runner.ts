import child_process from "child_process";
import eris from "eris";
import path from "path";
import { updateMessage, updateMessageWithError, updateMessageWithSessionOver } from "./actions";
import { SERVER_IPS, SessionState } from "./constants";
import { orm } from "./database";
import AmongUsSession from "./database/among-us-session";
import SessionChannel, { SessionChannelType } from "./database/session-channel";

const WORKING_DIR = path.resolve(path.join(__dirname, "../../client/bin/Debug/netcoreapp3.1"));
const CLIENT = path.join(WORKING_DIR, "client.exe");

class SessionRunner {
    private process: child_process.ChildProcess;
    private isConnected = false;

    constructor(private bot: eris.Client, private session: AmongUsSession) {}

    public async start() {
        this.process = child_process.spawn(CLIENT, [SERVER_IPS[this.session.region], this.session.lobbyCode], {
            cwd: WORKING_DIR,
        });

        this.process.stdout!.setEncoding("utf-8");
        this.process.stdout!.on("data", this.handleClientStdout);
        this.process.stdout!.on("close", () => this.handleDisconnect());
    }

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

    private async handleError(error: string) {
        await updateMessageWithError(this.bot, this.session, error);
        await orm.em.removeAndFlush(this.session);
    }

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
        this.session.channels.add(new SessionChannel(mutedChannel.id, SessionChannelType.TALKING));

        this.isConnected = true;
        await this.setStateToLobby();
    }

    private async setStateToLobby() {
        this.session.state = SessionState.LOBBY;
        await orm.em.flush();
        await updateMessage(this.bot, this.session);
    }

    private handleClientStdout = (msg: string) => {
        console.log("Got client: " + msg);
        const { type, ...rest } = JSON.parse(msg);

        if (type === "connect") {
            this.handleConnect();
        }

        if (type === "gameEnd") {
            this.setStateToLobby();
        }

        if (type === "disconnect") {
            this.handleDisconnect();
        }

        if (type === "error") {
            this.handleError(rest.message);
        }
    };
}

export default async function startSession(bot: eris.Client, session: AmongUsSession) {
    const runner = new SessionRunner(bot, session);
    await runner.start();
}
