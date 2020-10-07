import child_process from "child_process";
import eris from "eris";
import debounce from "lodash.debounce";
import path from "path";
import {
    addMessageReactions,
    movePlayersToSilenceChannel,
    movePlayersToTalkingChannel,
    mutePlayerInChannels,
    unmutePlayerInChannels,
    updateMessage,
    updateMessageWithError,
    updateMessageWithSessionOver,
} from "./actions";
import {
    EMOTE_IDS_TO_COLOR,
    GROUPING_TOGGLE_EMOJI,
    LEAVE_EMOJI,
    SERVER_IPS,
    SessionState,
    SHORT_REGION_NAMES,
} from "./constants";
import { orm } from "./database";
import AmongUsSession from "./database/among-us-session";
import PlayerLink from "./database/player-link";
import SessionChannel, { SessionChannelType } from "./database/session-channel";

const WORKING_DIR = path.resolve(process.env.AU_CLIENT_DIR!);
const CLIENT = path.join(WORKING_DIR, process.platform === "win32" ? "client.exe" : "client");

/**
 * Incomplete definition of the player data outputted by the client.
 */
export interface PlayerData {
    clientId: number;
    name: string;
    color: number;
    statusBitField: number;
    tasks: unknown[];
}

export const enum PlayerDataFlags {
    DISCONNECTED = 1,
    IMPOSTOR = 2,
    DEAD = 4,
}

/**
 * Class that handles all communication with the AU client in C#, using
 * JSON messages passed over the standard out to receive data from the client.
 */
class SessionRunner {
    private process: child_process.ChildProcess;
    private playerData: PlayerData[] = [];
    private deadPlayers = new Set<number>(); // clientIds of dead players
    private mutedPlayers = new Set<string>(); // snowflakes of muted players
    private isConnected = false;
    private isDestroyed = false;

    constructor(private bot: eris.Client, private session: AmongUsSession) {}

    /**
     * Starts this session, launching the client and attempting to connect to
     * the relevant lobby, as configured in the session.
     */
    public async start() {
        this.process = child_process.spawn(CLIENT, [SERVER_IPS[this.session.region], this.session.lobbyCode], {
            cwd: WORKING_DIR,
        });

        // Kill the process if it doesn't do anything after 30 seconds.
        setTimeout(() => {
            if (this.isConnected || this.isDestroyed) return;

            this.process.kill("SIGTERM");
            this.handleError(
                "It took too long to connect to the Among Us services. This is likely due to server load issues. Try again in a bit."
            );
        }, 30 * 1000);

        let buffered = "";

        this.process.stdout!.setEncoding("utf-8");
        this.process.stdout!.on("data", data => {
            for (const c of data) {
                buffered += c;

                if (c === "\n") {
                    this.handleClientStdout(buffered.trim());
                    buffered = "";
                }
            }
        });
        this.process.stdout!.on("close", () => this.handleDisconnect());

        this.process.stderr!.setEncoding("utf-8");
        this.process.stderr!.on("data", console.log);
    }

    /**
     * Invoked by listeners when the user reacts to the message with the specified
     * emoji id. It is already verified that emojiId is a valid color reaction.
     */
    public async handleEmojiSelection(emojiId: string, userId: string) {
        if (this.isDestroyed) return;

        if (emojiId === GROUPING_TOGGLE_EMOJI.split(":")[1]) {
            await this.toggleImpostorGrouping(userId);
            return;
        }

        if (emojiId === LEAVE_EMOJI.split(":")[1]) {
            await this.leaveLobby(userId);
            return;
        }

        const selectedColor = EMOTE_IDS_TO_COLOR[emojiId];
        if (selectedColor === undefined) return;

        await this.session.links.init();

        const relevantPlayer = this.playerData.find(x => x.color === selectedColor);
        if (!relevantPlayer) return;

        // Check if they had a different color selected, and remove if that was the case.
        const oldMatching = this.session.links.getItems().find(x => x.snowflake === userId);
        if (oldMatching) {
            await this.session.links.remove(oldMatching);
        }

        // if the old matching had the same client id, this is a re-react to remove the link.
        // if they don't match, add the link
        if (!oldMatching || oldMatching.clientId !== "" + relevantPlayer.clientId) {
            await this.session.links.add(new PlayerLink("" + relevantPlayer.clientId, userId));
        }

        await orm.em.flush();
        await this.updateMessage();

        // If this user already died, retroactively apply the mute.
        if (this.deadPlayers.has(relevantPlayer.clientId)) {
            this.mutePlayer(relevantPlayer.clientId).catch(() => {});
        }
    }

    /**
     * @returns whether the specified clientid is an impostor
     */
    public isImpostor(clientId: string): boolean {
        return this.playerData.some(
            x => "" + x.clientId === clientId && (x.statusBitField & PlayerDataFlags.IMPOSTOR) !== 0
        );
    }

    /**
     * Handles the usage of the leave react by any user.
     */
    private async leaveLobby(userId: string) {
        if (!this.isConnected || userId !== this.session.creator) return;

        this.process.kill("SIGINT"); // will trigger a disconnect
    }

    /**
     * Handles the usage of the toggle impostor grouping react by any user.
     */
    private async toggleImpostorGrouping(userId: string) {
        if (userId !== this.session.creator || this.session.state !== SessionState.LOBBY) {
            return;
        }

        this.session.groupImpostors = !this.session.groupImpostors;
        await orm.em.persistAndFlush(this.session);
        await this.updateMessage();

        console.log(`[+] Set impostor grouping to ${this.session.groupImpostors} for session ${this.session.id}`);

        // Create the impostor channel if needed.
        if (this.session.groupImpostors) {
            await this.session.channels.init();

            if (this.session.channels.getItems().some(x => x.type === SessionChannelType.IMPOSTORS)) return;
            const categoryChannel = this.session.channels.getItems().find(x => x.type === SessionChannelType.CATEGORY)!;

            const impostorChannel = await this.bot.createChannel(this.session.guild, "Impostors", 2, {
                parentID: categoryChannel.channelId,
                permissionOverwrites: [
                    {
                        type: "role",
                        id: this.session.guild,
                        deny: eris.Constants.Permissions.readMessages,
                        allow: 0,
                    },
                ],
            });
            this.session.channels.add(new SessionChannel(impostorChannel.id, SessionChannelType.IMPOSTORS));

            await orm.em.persistAndFlush(this.session);
        }
    }

    /**
     * Invoked when the client disconnects, such as when the lobby closes.
     * Should handle removal of the session and channels.
     */
    private async handleDisconnect() {
        if (!this.isConnected) return;

        this.isConnected = false;
        console.log(`[+] Session ${this.session.id} disconnected from Among Us`);

        await this.session.channels.init();
        for (const channel of this.session.channels) {
            await this.bot.deleteChannel(channel.channelId, "Among Us: Session is over.").catch(() => {});
        }

        await updateMessageWithSessionOver(this.bot, this.session);
        await orm.em.removeAndFlush(this.session);
        sessions.delete(this.session.id);
        this.isDestroyed = true;
    }

    /**
     * Invoked when the client encounters an error during startup. This
     * does not need to handle removal of channels, as they aren't created
     * yet.
     */
    private async handleError(error: string) {
        if (this.isDestroyed) return;

        console.log(`[+] Session ${this.session.id} encountered an error: '${error}'`);

        await updateMessageWithError(this.bot, this.session, error);
        await orm.em.removeAndFlush(this.session);
        this.isDestroyed = true;
        sessions.delete(this.session.id);
    }

    /**
     * Invoked when the client successfully joins the lobby indicated in the
     * current session. Creates the relevant voice channels and updates the state.
     */
    private async handleConnect() {
        if (this.isConnected || this.isDestroyed) return;

        console.log(`[+] Session ${this.session.id} connected to lobby.`);

        const category = await this.bot.createChannel(
            this.session.guild,
            "Among Us - " + SHORT_REGION_NAMES[this.session.region] + " - " + this.session.lobbyCode,
            4,
            "Among Us: Create category for voice channels."
        );
        this.session.channels.add(new SessionChannel(category.id, SessionChannelType.CATEGORY));

        const talkingChannel = await this.bot.createChannel(this.session.guild, "Discussion", 2, {
            parentID: category.id,
        });

        const talkingInvite = await talkingChannel.createInvite({
            unique: true,
        });

        this.session.channels.add(
            new SessionChannel(talkingChannel.id, SessionChannelType.TALKING, talkingInvite.code)
        );

        const mutedChannel = await this.bot.createChannel(this.session.guild, "Muted", 2, {
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
        await orm.em.persistAndFlush(this.session);
        await Promise.all([this.setStateTo(SessionState.LOBBY), addMessageReactions(this.bot, this.session)]);
    }

    /**
     * Simple method that changes the current state of the lobby to the specified
     * state, then ensures that the chat message is updated to reflect this state.
     */
    private async setStateTo(state: SessionState) {
        if (this.isDestroyed) return;

        this.session.state = state;
        await orm.em.flush();
        await this.updateMessage();
    }

    /**
     * Processes a game data update from the client, updating the message where
     * appropriate.
     */
    private async handlePlayerDataUpdate(newData: PlayerData[]) {
        const oldByClientId = new Map(this.playerData.map(x => [x.clientId, x]));
        const newByClientId = new Map(newData.map(x => [x.clientId, x]));

        let shouldUpdateMessage = oldByClientId.size !== newByClientId.size;
        for (const [oldId, oldData] of oldByClientId) {
            const newData = newByClientId.get(oldId);
            if (!newData || oldData.name !== newData.name || oldData.color !== newData.color)
                shouldUpdateMessage = true;
        }

        for (const [newId, newData] of newByClientId) {
            if ((newData.statusBitField & PlayerDataFlags.DEAD) !== 0 && !this.deadPlayers.has(newId)) {
                this.deadPlayers.add(newId);
                this.mutePlayer(newId).catch(() => {});
            }
        }

        this.playerData = newData;
        if (shouldUpdateMessage && this.isConnected) {
            await this.debouncedUpdateMessage();
        }

        // if we're in lobby but everyone has tasks now, we've started
        if (this.session.state === SessionState.LOBBY && !this.playerData.some(x => !x.tasks || !x.tasks.length)) {
            await this.setStateTo(SessionState.PLAYING);
            await movePlayersToSilenceChannel(this.bot, this.session);
        }
    }

    /**
     * Updates the message for the current state of the lobby.
     */
    private async updateMessage() {
        await updateMessage(this.bot, this.session, this.playerData);
    }

    /**
     * Version of {@link updateMessage} that will debounce to ensure that
     * updates are not pushed too frequently.
     */
    private debouncedUpdateMessage = debounce(() => this.updateMessage(), 200);

    /**
     * Mutes the specified player in the talking channel because they died,
     * if they had linked their among us character with their discord.
     */
    private async mutePlayer(clientId: number) {
        await this.session.links.init();
        await this.session.channels.init();

        const links = this.session.links.getItems().filter(x => x.clientId === "" + clientId);
        for (const link of links) {
            this.mutedPlayers.add(link.snowflake);
            await mutePlayerInChannels(this.bot, this.session, link.snowflake);
        }
    }

    /**
     * Unmutes all players in the main channel that were previously muted.
     */
    private async unmutePlayers() {
        await Promise.all([...this.mutedPlayers].map(x => unmutePlayerInChannels(this.bot, this.session, x)));
        this.mutedPlayers.clear();
    }

    /**
     * Receives and handles output from the client, parsing the result into
     * a JSON message and then dispatching the result of that message.
     */
    private handleClientStdout = async (msg: string) => {
        if (this.isDestroyed) return;

        msg = msg.trim();
        if (!msg.length) return;
        const { type, ...rest } = JSON.parse(msg);

        if (type === "connect") {
            await this.handleConnect();
        }

        if (type === "gameEnd") {
            console.log(`[+] Session ${this.session.id}: game ended`);

            await this.setStateTo(SessionState.LOBBY);
            await this.unmutePlayers();
            await movePlayersToTalkingChannel(this.bot, this.session);
        }

        if (type === "talkingStart") {
            console.log(`[+] Session ${this.session.id}: talking started`);
            await this.setStateTo(SessionState.DISCUSSING);
            await movePlayersToTalkingChannel(this.bot, this.session);
        }

        if (type === "talkingEnd") {
            console.log(`[+] Session ${this.session.id}: talking ended`);

            if (this.session.state === SessionState.LOBBY) {
                // Don't transition until we have all the impostor information.
                return;
            }

            await this.setStateTo(SessionState.PLAYING);
            await movePlayersToSilenceChannel(this.bot, this.session);
        }

        if (type === "disconnect") {
            await this.handleDisconnect();
        }

        if (type === "gameData") {
            await this.handlePlayerDataUpdate(rest.data);
        }

        if (type === "error") {
            await this.handleError(rest.message);
        }
    };
}

const sessions = new Map<number, SessionRunner>();

/**
 * Returns the current session runner for the specified session, or null
 * if it does not exist.
 */
export function getRunnerForSession(session: AmongUsSession): SessionRunner | null {
    return sessions.get(session.id) || null;
}

/**
 * Creates a new client instance for the specified AmongUsSession, causing
 * it to connect to the lobby and handle events. This method should never
 * directly throw.
 */
export default async function startSession(bot: eris.Client, session: AmongUsSession) {
    const runner = new SessionRunner(bot, session);
    sessions.set(session.id, runner);
    await runner.start();
}
