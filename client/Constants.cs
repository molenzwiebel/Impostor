using System.Linq;

namespace client
{
    /**
     * Represents the tags of messages sent by/to us from the matchmaking servers.
     */
    public enum MMTags : byte
    {
        HostGame = 0,
        JoinGame = 1,
        StartGame = 2,
        RemoveGame = 3,
        RemovePlayer = 4,
        GameData = 5,
        GameDataTo = 6,
        JoinedGame = 7,
        EndGame = 8,
        AlterGame = 10,
        KickPlayer = 11,
        WaitForHost = 12,
        Redirect = 13,
        ReselectServer = 14,
        GetGameList = 9,
        GetGameListV2 = 16,
    }

    /**
     * Represents the tags of messages sent by/to us through MM GameData packets.
     */
    public enum GameDataTags : byte
    {
        Data = 1,
        Rpc = 2,
        Spawn = 4,
        Despawn = 5,
        SceneChange = 6,
        Ready = 7,
        ChangeSettings = 8,
    }

    /**
     * Represents the set of possible RCP actions that can be invoked by a client.
     */
    public enum RPCCalls : byte
    {
        PlayAnimation = 0,
        CompleteTask = 1,
        SyncSettings = 2,
        SetInfected = 3,
        Exiled = 4,
        CheckName = 5,
        SetName = 6,
        CheckColor = 7,
        SetColor = 8,
        SetHat = 9,
        SetSkin = 10,
        ReportDeadBody = 11,
        MurderPlayer = 12,
        SendChat = 13,
        StartMeeting = 14,
        SetScanner = 15,
        SendChatNote = 16,
        SetPet = 17,
        SetStartCounter = 18,
        EnterVent = 19,
        ExitVent = 20,
        SnapTo = 21,
        Close = 22,
        VotingComplete = 23,
        CastVote = 24,
        ClearVote = 25,
        AddVote = 26,
        CloseDoorsOfType = 27,
        RepairSystem = 28,
        SetTasks = 29,
        UpdateGameData = 30
    }

    /**
     * Represents a reason for being disconnected, as reported by the server.
     */
    public enum DisconnectReasons
    {
        ExitGame = 0,
        GameFull = 1,
        GameStarted = 2,
        GameNotFound = 3,
        IncorrectVersion = 5,
        Banned = 6,
        Kicked = 7,
        Custom = 8,
        InvalidName = 9,
        Hacking = 10,
        Destroy = 16,
        Error = 17,
        IncorrectGame = 18,
        ServerRequest = 19,
        ServerFull = 20,
        FocusLostBackground = 207,
        IntentionalLeaving = 208,
        FocusLost = 209,
        NewConnection = 210
    }
    
    /// <summary>
    /// Represents a type of object that can be spawned by the host.
    /// </summary>
    public enum SpawnableObjects : byte
    {
        ShipStatus0 = 0,
        MeetingHud = 1,
        LobbyBehavior = 2,
        GameData = 3,
        PlayerControl = 4,
        ShipStatus1 = 5,
        ShipStatus2 = 6,
        ShipStatus3 = 7
    }

    /**
     * Utility class for converting from/to lobby game names and their integer identifier counterparts.
     */
    public static class GameCode
    {
        private static string V2 = "QWXRTYLPESDFGHUJKZOCVBINMA";
        private static int[] V2Map = Enumerable.Range(65, 26).Select(x => V2.IndexOf((char) x)).ToArray();

        /**
         * Converts the specified game ID integer into the string representation.
         */
        public static string IntToGameNameV2(int gameId)
        {
            var ret = new char[6];

            var v4 = gameId & 0x3FF;
            var v5 = (gameId >> 10) & 0xFFFF;

            ret[0] = V2[v4 % 26];
            ret[1] = V2[v4 / 26];
            ret[2] = V2[v5 % 26];
            ret[3] = V2[v5 / 26 % 26];
            ret[4] = V2[v5 / 676 % 26];
            ret[5] = V2[v5 / 17576 % 26];

            return new string(ret);
        }

        /**
         * Converts the specified game name into its integer representation.
         */
        public static int GameNameToIntV2(string gameName)
        {
            gameName = gameName.ToUpperInvariant();

            var a = V2Map[gameName[0] - 'A'];
            var b = V2Map[gameName[1] - 'A'];
            var c = V2Map[gameName[2] - 'A'];
            var d = V2Map[gameName[3] - 'A'];
            var e = V2Map[gameName[4] - 'A'];
            var f = V2Map[gameName[5] - 'A'];

            // Spaghetti
            return (int) (((ushort) a + 26 * (ushort) b) & 0x3FF |
                          ((c + 26 * ((uint) d + 26 * (e + 26 * f))) << 10) & 0x3FFFFC00 | 0x80000000);
        }
    }
}