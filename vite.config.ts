import path from 'path';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import { defineConfig } from 'vite';

const meta = JSON.parse(fs.readFileSync('./public/meta.json', 'utf8'));

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
				// 用 127.0.0.1 而非 localhost：Node 会先试 IPv6 ::1，而容器端口只发布在
				// 127.0.0.1 上，localhost 解析导致每请求 ~7s 的回退延迟。
				target: 'http://127.0.0.1:8888',
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/openmeter/, ''),
			},
		},
	},
});
