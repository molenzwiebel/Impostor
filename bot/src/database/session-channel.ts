import { Entity, Enum, ManyToOne, PrimaryKey, Property } from "@mikro-orm/core";
import AmongUsSession from "./among-us-session";

/**
 * Represents a channel that was created by an among us session and should
 * be cleaned up on the end of that session.
 */
@Entity()
export default class SessionChannel {
    @PrimaryKey()
    id!: number;

    /**
     * The session this channel belongs to.
     */
    @ManyToOne(() => AmongUsSession)
    session!: AmongUsSession;

    /**
     * The discord id of the channel.
     */
    @Property()
    channelId!: string;

    /**
     * The particular type of this channel.
     */
    @Enum()
    type!: SessionChannelType;
}

export const enum SessionChannelType {
    TALKING = "talking",
    SILENCE = "silence",
}
