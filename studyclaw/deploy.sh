#!/bin/bash

# StudyClaw Deployment Script for AWS

set -e

echo "🚀 StudyClaw Deployment"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️  .env not found. Creating from example...${NC}"
    cp .env.example .env
    echo -e "${RED}❌ Please edit .env with your values first!${NC}"
    echo "   DATABASE_URL, JWT_SECRET, OPENCLAW_URL, OPENCLAW_TOKEN, ADMIN_KEY"
    exit 1
fi

# Check Docker
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Installing Docker...${NC}"
    sudo apt update
    sudo apt install -y docker.io docker-compose
fi

# Check if Docker is running
if ! docker info &> /dev/null; then
    echo -e "${RED}❌ Docker is not running. Start it with: sudo systemctl start docker${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Docker is running${NC}"

# Pull latest if git repo
if [ -d .git ]; then
    echo -e "${YELLOW}📦 Pulling latest changes...${NC}"
    git pull || echo "⚠️  Not a git repo or pull failed, continuing..."
fi

# Build and start
echo -e "${GREEN}🏗️  Building containers...${NC}"
docker-compose build

echo -e "${GREEN}🚀 Starting services...${NC}"
docker-compose up -d

# Wait for API
echo -e "${YELLOW}⏳ Waiting for API to be ready...${NC}"
sleep 5

# Health check
if curl -s http://localhost:3000/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ StudyClaw is running!${NC}"
    echo ""
    echo "📡 API:        http://localhost:3000"
    echo "📚 Health:     http://localhost:3000/health"
    echo ""
    echo "Next steps:"
    echo "  1. Configure your domain (optional)"
    echo "  2. Set up HTTPS with certbot"
    echo "  3. Connect your mobile app to http://YOUR_IP:3000"
else
    echo -e "${RED}❌ API not responding. Check logs:${NC}"
    docker-compose logs api
fi
