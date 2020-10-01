import { Entity, Enum, ManyToOne, PrimaryKey, Property } from "@mikro-orm/core";
import AmongUsSession from "./among-us-session";

/**
 * Represents a specific discord player that has associated itself with a specific
 * color/client id in the session through the use of a reaction emote.
 */
@Entity()
export default class PlayerLink {
    @PrimaryKey()
    id!: number;

    /**
     * The session this channel belongs to.
     */
    @ManyToOne(() => AmongUsSession)
    session!: AmongUsSession;

    /**
     * The client id of the connected lobby user.
     */
    @Property()
    clientId!: string;

    /**
     * The ID/snowflake of the discord user associated with this link.
     */
    @Property()
    snowflake!: string;
}
