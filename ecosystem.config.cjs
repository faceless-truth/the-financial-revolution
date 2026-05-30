module.exports = {
  apps: [{
    name: 'financial-revolution',
    script: 'pnpm',
    args: 'start',
    cwd: '/root/website',
    env: {
      NODE_ENV: 'production',
      PORT: '3001',
      CRYPTO_DASHBOARD_ROOT: '/root/crypto_dashboard'
    }
  }]
}
