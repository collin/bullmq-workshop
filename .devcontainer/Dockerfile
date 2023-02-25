# [Choice] Node.js version: 14, 12, 10
ARG VARIANT=18
FROM mcr.microsoft.com/vscode/devcontainers/typescript-node:${VARIANT}

# RUN wget https://github.com/robbyrussell/oh-my-zsh/raw/master/tools/install.sh -O - | zsh || true

# Copy the full repository into the /workspace directory
WORKDIR /workspace
COPY . .