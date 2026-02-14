const http = require('http');

// Helper to make requests
function request(method, path, body) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3002,
            path: '/api' + path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
            },
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve(data);
                }
            });
        });

        req.on('error', (e) => reject(e));
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function run() {
    try {
        console.log('Fetching projects...');
        const projects = await request('GET', '/projects');
        if (!Array.isArray(projects) || projects.length === 0) {
            console.error('No projects found. Seed the DB first.');
            return;
        }

        const project = projects[0];
        console.log(`Using project: ${project.name} (${project.id})`);

        console.log('Starting export...');
        const requestId = `test_export_${Date.now()}`;
        const job = await request('POST', `/${project.id}/export`, { requestId });

        if (job.error) {
            console.error('Export failed to start:', job.error);
            return;
        }

        console.log(`Export started. Job ID: ${job.id}`);

        // Poll status
        const poll = setInterval(async () => {
            const status = await request('GET', `/exports/${job.id}`);
            console.log(`Status: ${status.status}, Progress: ${status.progress}%`);

            if (status.status === 'COMPLETE') {
                console.log('Export Complete!', status.output_path);
                clearInterval(poll);
            } else if (status.status === 'FAILED') {
                console.error('Export Failed:', status.error);
                clearInterval(poll);
            }
        }, 2000);

    } catch (err) {
        console.error('Error:', err);
    }
}

run();
