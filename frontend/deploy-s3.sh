#!/bin/bash

# Configuration
BUCKET_NAME="knowledge-repo-rag"
DIST_DIR="dist"
REGION="ap-southeast-1"
CLOUDFRONT_DISTRIBUTION_ID="EV2CQI4IMNHX6"

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
    --delete

aws cloudfront create-invalidation \
  --distribution-id $CLOUDFRONT_DISTRIBUTION_ID \
  --paths "/*" \
  --no-cli-pager

echo -e "${GREEN}✅ Deployment completed successfully!${NC}"
echo -e "${GREEN}🌐 Your website is available at: http://$BUCKET_NAME.s3-website-$REGION.amazonaws.com${NC}" 