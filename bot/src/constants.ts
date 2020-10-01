export const enum LobbyRegion {
    ASIA = "Asia",
    NORTH_AMERICA = "North America",
    EUROPE = "Europe",
}

export const enum SessionState {
    LOBBY = "lobby",
    PLAYING = "playing",
    DISCUSSING = "discussing",
}

export const SERVER_IPS = {
    [LobbyRegion.EUROPE]: "172.105.251.170",
    [LobbyRegion.NORTH_AMERICA]: "198.58.99.71",
    [LobbyRegion.ASIA]: "139.162.111.196",
};

export const COLOR_EMOTES = {
    [0]: "<:crewmate_red:761211569635459092>",
    [1]: "<:crewmate_blue:761211569546985502>",
    [2]: "<:crewmate_green:761211569744904232>",
    [3]: "<:crewmate_pink:761211569379999806>",
    [4]: "<:crewmate_orange:761211569606361127>",
    [5]: "<:crewmate_yellow:761211569950294046>",
    [6]: "<:crewmate_black:761211569597710356>",
    [7]: "<:crewmate_white:761211569950162985>",
    [8]: "<:crewmate_purple:761211569282744332>",
    [9]: "<:crewmate_brown:761211569467818015>",
    [10]: "<:crewmate_cyan:761211569744510976>",
    [11]: "<:crewmate_lime:761211569555636226>",
};
