# Deployment Guide

This repository contains independently runnable services. A production-style deployment can keep the frontend, API gateway, and AI orchestrator as separate services.

## Frontend

Deploy `frontend/` to Vercel or another static frontend host.

Configure `VITE_BACKEND_BASE_URL` and `VITE_ORG_ID`.

## API gateway

Deploy `backend/` to Render, AWS ECS, or a comparable Node.js service host.

Configure the required values by environment, including `PORT`, `CORS_ORIGIN`, `MONGODB_URI` or `MONGO_URI`, `LLM_BASE_URL`, `BAMBOOHR_COMPANY`, `BAMBOOHR_API_KEY`, `SLACK_BOT_TOKEN`, and the Google OAuth/calendar credential names used by the connector.

## Database

Use MongoDB Atlas for managed MongoDB. Set the connection string through `MONGODB_URI` or `MONGO_URI`; do not place credentials in source files.

## AI orchestrator

Deploy `llm/` to Render, AWS ECS, or another Node.js service host.

Configure `PORT`, `MONGO_URI`, `MONGO_DB`, `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_DISPATCH_MODE`, `QUEUE_MODE`, `REDIS_URL`, `DATA_ROOT`, `USE_MEMORY_STORE`, `USE_MEMORY_CACHE`, and `SLACK_BOT_TOKEN`.

## Operational notes

- Keep the API gateway and AI orchestrator on private service-to-service networking in production.
- Restrict CORS to the deployed frontend origin.
- Store credentials in the host’s secret manager or environment configuration.
- Use separate MongoDB databases or organizations for development and production.
- Do not commit `.env` files, real employee exports, transcripts, Slack messages, or generated database dumps.
