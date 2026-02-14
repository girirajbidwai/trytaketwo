const Database = require('better-sqlite3');
const path = require('path');
const DB_PATH = path.join(__dirname, 'data', 'editor.db');
const db = new Database(DB_PATH);

const projects = db.prepare('SELECT * FROM projects').all();
console.log('=== Projects ===');
console.log(JSON.stringify(projects, null, 2));

const jobs = db.prepare('SELECT * FROM export_jobs').all();
console.log('\n=== Export Jobs ===');
console.log(JSON.stringify(jobs, null, 2));
