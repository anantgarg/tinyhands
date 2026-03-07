FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    jq \
    ripgrep \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Agent SDK
RUN npm install -g @anthropic-ai/claude-code

# Create workspace directory
RUN mkdir -p /workspace
WORKDIR /workspace

# Non-root user for security
RUN groupadd -r agent && useradd -r -g agent -m agent
USER agent

ENTRYPOINT ["claude"]
