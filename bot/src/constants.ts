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
