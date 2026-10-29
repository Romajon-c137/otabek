FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN useradd --create-home --uid 10001 appuser
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY . /app
RUN mkdir -p /app/media /app/staticfiles \
    && chmod +x /app/entrypoint.sh \
    && chown -R appuser:appuser /app
USER appuser
EXPOSE 8000
CMD ["/app/entrypoint.sh"]

