module.exports = {
  project: {
    name: 'b2-up-down',
    type: 'fullstack'
  },
  apps: {
    frontend: {
      root: 'frontend',
      type: 'react',
      port: 3000
    },
    backend: {
      root: 'backend',
      type: 'node',
      port: 5005
    }
  }
}; 