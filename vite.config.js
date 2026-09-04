import path from 'path';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import { defineConfig } from 'vite';
var meta = JSON.parse(fs.readFileSync('./public/meta.json', 'utf8'));
export default defineConfig({
    plugins: [react()],
    define: {
        __APP_VERSION__: JSON.stringify(meta.versionId),
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    server: {
        cors: {
            origin: 'http://localhost:3000',
            methods: ['GET', 'POST'],
        },
        host: 'localhost',
        proxy: {
            // OpenMeter 社区版不返回 CORS 头，浏览器端 ingestion/查询需走同源代理；
            // 将 VITE_OPENMETER_URL 设为 /openmeter 即可（生产环境由反向代理承担）。
            '/openmeter': {
                target: 'http://localhost:8888',
                changeOrigin: true,
                rewrite: function (path) { return path.replace(/^\/openmeter/, ''); },
            },
        },
    },
});
