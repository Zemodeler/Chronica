#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "Installing dependencies..."
npm install

echo "Opening browser..."
sleep 3 && open "http://localhost:3000" &

echo "Starting Chronica..."
npm run dev
