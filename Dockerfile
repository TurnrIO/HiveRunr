FROM python:3.12-slim

# Create a non-root user so the process cannot write to the image filesystem
# or escalate privileges even if a dependency is compromised.
RUN groupadd --gid 1001 hiverunr \
 && useradd --uid 1001 --gid hiverunr --shell /bin/bash --create-home hiverunr

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY migrations/ ./migrations/
COPY alembic.ini .

# Hand ownership of the working directory to the app user
RUN chown -R hiverunr:hiverunr /app

USER hiverunr

CMD ["uvicorn","app.main:app","--host","0.0.0.0","--port","8000"]
