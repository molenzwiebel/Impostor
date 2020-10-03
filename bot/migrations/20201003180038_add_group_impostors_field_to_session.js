exports.up = knex =>
    knex.schema.table("among_us_session", table => {
        table.specificType("creator", "text").defaultTo("");
        table.boolean("group_impostors").defaultTo(false);
    });

exports.down = knex =>
    knex.schema.table("among_us_session", table => {
        table.dropColumn("creator");
        table.dropColumn("group_impostors");
    });
