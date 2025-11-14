const {Pool} = require(pg);

const pool = new Pool({
    user: 'ikeda',
    host: 'localhost',
    database: 'attendance_db',
    password: 'mizuki0311',
    port: 5432,
});

module.exports = {
    query: (text, params) => pool.query(text, params),
    getClient: () => pool.connect(),
    pool: pool,
};