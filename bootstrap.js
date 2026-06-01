const jwtSecret = process.env.JWT_SECRET?.trim();
if (!jwtSecret || jwtSecret.length < 16) {
  console.error(
    '❌ JWT_SECRET es obligatorio y debe tener al menos 16 caracteres. Defínalo en backend/.env o en variables de entorno.'
  );
  process.exit(1);
}
