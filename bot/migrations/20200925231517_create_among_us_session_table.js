exports.up = knex =>
    knex.schema.createTable("among_us_session", table => {
        table.increments("id").primary();
        table.specificType("guild", "text").notNullable();
        table.specificType("channel", "text").notNullable();
        table.specificType("message", "text").notNullable();
        table.specificType("user", "text").notNullable();
        table.specificType("state", "text").notNullable();
        table.specificType("region", "text").notNullable();
        table.specificType("lobby_code", "text").notNullable();
    });

exports.down = knex => knex.schema.dropTableIfExists("among_us_session");
