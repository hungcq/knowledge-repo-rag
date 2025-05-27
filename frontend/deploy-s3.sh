#!/bin/bash

# Configuration
BUCKET_NAME="knowledge-repo-rag"
DIST_DIR="dist"
REGION="ap-southeast-1"  # Change this to your desired AWS region

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

npm run build --production

echo "🚀 Starting S3 deployment..."

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI is not installed. Please install it first.${NC}"
    exit 1
fi

# Check if bucket exists
if ! aws s3api head-bucket --bucket $BUCKET_NAME 2>/dev/null; then
    echo -e "${RED}❌ Bucket $BUCKET_NAME does not exist or you don't have access to it.${NC}"
    exit 1
fi

# Check if dist directory exists
if [ ! -d "$DIST_DIR" ]; then
    echo -e "${RED}❌ Build directory ($DIST_DIR) not found. Please run 'npm run build' first.${NC}"
    exit 1
fi

# Upload files to S3
echo "📤 Uploading files to S3..."
aws s3 sync $DIST_DIR s3://$BUCKET_NAME \
    --region $REGION \
    --delete \
    --cache-control "max-age=31536000,public" \
    --exclude "*.html" \
    --exclude "*.json" \
    --exclude "*.xml"

# Upload HTML files with different cache control
echo "📤 Uploading HTML files..."
aws s3 sync $DIST_DIR s3://$BUCKET_NAME \
    --region $REGION \
    --delete \
    --cache-control "no-cache" \
    --include "*.html"

# Upload JSON and XML files with different cache control
echo "📤 Uploading JSON and XML files..."
aws s3 sync $DIST_DIR s3://$BUCKET_NAME \
    --region $REGION \
    --delete \
    --cache-control "no-cache" \
    --include "*.json" \
    --include "*.xml"

echo -e "${GREEN}✅ Deployment completed successfully!${NC}"
echo -e "${GREEN}🌐 Your website is available at: http://$BUCKET_NAME.s3-website-$REGION.amazonaws.com${NC}" 