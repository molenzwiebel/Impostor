using System;
using System.Collections.Generic;
using System.Linq;
using Hazel;

namespace client
{
    public class PlayerData
    {
        public uint clientId;
        public byte id;
        public string name;
        public byte color;
        public int hatId;
        public int petId;
        public int skinId;
        public byte statusBitField;
        public List<PlayerDataTask> tasks;

        public PlayerData(uint clientId, byte id)
        {
            this.clientId = clientId;
            this.id = id;
        }

        public override string ToString()
        {
            return $"{nameof(id)}: {id}, {nameof(name)}: {name}, {nameof(color)}: {color}, {nameof(hatId)}: {hatId}, {nameof(petId)}: {petId}, {nameof(skinId)}: {skinId}, {nameof(statusBitField)}: {statusBitField}, {nameof(tasks)}: {tasks}";
        }

        public void Deserialize(MessageReader message)
        {
            name = message.ReadString();
            color = message.ReadByte();
            hatId = message.ReadPackedInt32();
            petId = message.ReadPackedInt32();
            skinId = message.ReadPackedInt32();
            statusBitField = message.ReadByte();

            var taskLen = message.ReadByte();
            tasks = Enumerable.Range(0, taskLen).Select(x =>
            {
                var task = new PlayerDataTask();
                task.Deserialize(message);
                return task;
            }).ToList();
        }

        public void Serialize(MessageWriter writer)
        {
            writer.Write(name);
            writer.Write((byte) color);
            writer.WritePacked(hatId);
            writer.WritePacked(petId);
            writer.WritePacked(skinId);
            writer.Write((byte) statusBitField);
            writer.Write((byte) tasks.Count);
            foreach (var task in tasks) task.Serialize(writer);
        }
    }

    public class PlayerDataTask
    {
        public int id;
        public bool complete;

        public void Deserialize(MessageReader reader)
        {
            id = reader.ReadPackedInt32();
            complete = reader.ReadBoolean();
        }

        public void Serialize(MessageWriter writer)
        {
            writer.WritePacked(id);
            writer.Write(complete);
        }

        public override string ToString()
        {
            return $"{nameof(id)}: {id}, {nameof(complete)}: {complete}";
        }
    }
}