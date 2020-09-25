exports.up = knex =>
    knex.schema.createTable("session_channel", table => {
        table.increments("id").primary();
        table.integer("session_id").unsigned().references("id").inTable("among_us_session").onDelete("cascade");
        table.specificType("channel_id", "text").notNullable();
        table.specificType("invite", "text").nullable();
        table.specificType("type", "text").notNullable();
    });

exports.down = knex => knex.schema.dropTableIfExists("session_channel");
