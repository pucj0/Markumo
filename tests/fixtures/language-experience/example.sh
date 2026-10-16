#!/bin/bash
# Shell 中文注释
export NODE_ENV=production
count=42
echo "Hello LightEdit"
if [ "$count" -gt 1 ]; then
  npm install
fi
