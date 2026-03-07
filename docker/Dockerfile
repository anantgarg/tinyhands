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

# Create workspace and tools directories
RUN mkdir -p /workspace /tools /sources /memory
WORKDIR /workspace

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Non-root user for security
RUN groupadd -r agent && useradd -r -g agent -m agent
RUN chown -R agent:agent /workspace /tools
USER agent

ENTRYPOINT ["/entrypoint.sh"]
