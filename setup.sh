#!/bin/bash
echo "=========================================================="
echo "      Starting DXY Trading Bot Automated Setup            "
echo "=========================================================="

# Create project subfolders
mkdir -p backend
mkdir -p frontend/src/components
mkdir -p frontend/src/services

# Install root/backend dependencies
echo "[1/4] Installing backend dependencies in root..."
npm install

# Check if .env already exists, otherwise copy from example
if [ ! -f .env ]; then
    echo "[2/4] Creating .env file from template..."
    cp .env.example .env
else
    echo "[2/4] .env already exists. Skipping copy..."
fi

# Initialize React App with Vite if not exists
if [ ! -d "frontend" ] || [ ! -f "frontend/package.json" ]; then
    echo "[3/4] Creating React Vite frontend..."
    # npx create-vite-app or standard create-vite
    npx -y create-vite@latest frontend --template react
fi

# Install React dependencies
echo "[4/4] Installing frontend dependencies..."
cd frontend
npm install
npm install recharts axios
cd ..

echo ""
echo "=========================================================="
echo "                Setup Complete Successfully!              "
echo "=========================================================="
echo "1. Verify/update your mail credentials in the .env file."
echo "2. Start both frontend + backend by running: npm start"
echo "3. Open http://localhost:5002 in your browser."
echo "=========================================================="
