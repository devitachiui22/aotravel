module.exports = {
  apps: [
    {
      name: 'aotravel-backend',
      script: 'server.js',
      instances: 'max',
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      error_file: './logs/pm2-err.log',
      out_file: './logs/pm2-out.log',
      log_file: './logs/pm2-combined.log',
      time: true,
      merge_logs: true,
      kill_timeout: 5000,
      listen_timeout: 5000,
      shutdown_with_message: true,
      max_restarts: 10,
      restart_delay: 4000
    }
  ],

  deploy: {
    production: {
      user: 'ubuntu',
      host: ['your-server-ip'],
      ref: 'origin/main',
      repo: 'git@github.com:aotravel/backend.git',
      path: '/var/www/aotravel-backend',
      'post-deploy': 'npm ci --only=production && pm2 reload ecosystem.config.js --env production',
      env: {
        NODE_ENV: 'production'
      }
    }
  }
};
