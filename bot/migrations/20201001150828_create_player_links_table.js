exports.up = knex =>
    knex.schema.createTable("player_link", table => {
        table.increments("id").primary();
        table.integer("session_id").unsigned().references("id").inTable("among_us_session").onDelete("cascade");
        table.specificType("client_id", "text").notNullable();
        table.specificType("snowflake", "text").notNullable();
    });

exports.down = knex => knex.schema.dropTableIfExists("player_link");
