require("dotenv/config");

const db = {
    // MikroORM
    type: "postgresql",
    dbName: "impostor",
    clientUrl: process.env.DATABASE_URL,

    // Knex
    client: "postgres",
    connection: process.env.DATABASE_URL,
};

module.exports = {
    development: db,
    production: db,
};