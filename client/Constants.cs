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
}