# StudyClaw AWS Deployment Guide

## Prerequisites

1. **AWS Account** - EC2 instance (Ubuntu 22.04)
2. **Domain** (optional) - For HTTPS
3. **OpenClaw** - Your gateway running somewhere (or on same server)

---

## Quick Deploy

### 1. Launch EC2

- **AMI**: Ubuntu 22.04 LTS
- **Type**: t3.small (minimum) - 2 vCPU, 2GB RAM
- **Storage**: 30GB SSD
- **Security Group**:
  - SSH (22)
  - HTTP (80)
  - HTTPS (443)
  - Custom TCP (3000) - for API

### 2. SSH & Install Docker

```bash
ssh ubuntu@YOUR-EC2-IP

# Install Docker
sudo apt update && sudo apt install -y docker.io docker-compose

# Add user to docker group
sudo usermod -aG docker $USER
exit
# Re-login
```

### 3. Clone & Deploy

```bash
# Clone repo
git clone https://github.com/cryptorich615/studyclaw.git
cd studyclaw

# Create environment file
cp .env.example .env
nano .env
```

### 4. Configure .env

```env
# Required - Fill these in:
DATABASE_URL="postgresql://studyclaw:YOUR_PASSWORD@db:5432/studyclaw"
JWT_SECRET=super_secure_random_string_min_32_chars
OPENCLAW_URL=http://YOUR_OPENCLAW_IP:8080
OPENCLAW_TOKEN=your_openclaw_token
ADMIN_KEY=your_admin_key_for_dixie

# Optional
PORT=3000
NODE_ENV=production
```

### 5. Start

```bash
# Start everything (API + DB + OpenClaw)
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f api
```

### 6. Test

```bash
# Health check
curl http://localhost:3000/health

# Test Dixie
curl -X POST http://localhost:3000/api/v1/dixie/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello!"}'
```

---

## Architecture on AWS

```
Internet
    │
    ▼
┌─────────────────┐
│   EC2 Instance  │
│                 │
│  ┌───────────┐  │
│  │   Nginx   │  │  Port 80/443
│  └─────┬─────┘  │
│        │        │
│  ┌─────┴─────┐  │
│  │    API    │  │  Port 3000
│  └─────┬─────┘  │
│        │        │
│  ┌─────┴─────┐  │
│  │  OpenClaw │  │  Port 8080
│  └─────┬─────┘  │
│        │        │
│  ┌─────┴─────┐  │
│  │ PostgreSQL │  │  Port 5432
│  └───────────┘  │
└─────────────────┘
```

---

## Updating

```bash
# Pull latest code
git pull

# Rebuild & restart
docker-compose down
docker-compose build
docker-compose up -d
```

---

## Troubleshooting

### Port issues
```bash
sudo ufw allow 3000
sudo ufw allow 80
sudo ufw allow 443
```

### View logs
```bash
docker-compose logs -f
docker-compose logs -f api
docker-compose logs -f db
```

### Restart
```bash
docker-compose restart
```

### Database issues
```bash
# Reset database
docker-compose down -v  # WARNING: deletes all data
docker-compose up -d
```

---

## HTTPS (Optional)

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Get certificate
sudo certbot --nginx -d your-domain.com

# Auto-renew
sudo certbot renew --dry-run
```
