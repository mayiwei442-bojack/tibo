FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PLAYWRIGHT_BROWSERS_PATH=/opt/browsers
WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt \
    && python -m playwright install --with-deps chromium \
    && useradd --create-home monitor \
    && chmod -R a+rX /opt/browsers
COPY . /app/scraper
USER monitor
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "scraper.app:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
