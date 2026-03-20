FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Source is bind-mounted at runtime; COPY is only a fallback for plain 'docker build'.
COPY app/ ./app/

EXPOSE 8000
# --reload makes uvicorn restart on any .py file change inside /app
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
