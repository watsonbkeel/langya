module.exports = {
  apps: [
    {
      name: 'langyashan-server',
      script: 'dist/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      time: true,
      env: {
        NODE_ENV: 'production',
        PROJECT_ROOT: '..',
      },
    },
  ],
};
