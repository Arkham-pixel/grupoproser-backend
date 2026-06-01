import mongoose from "mongoose";

const SECONDARY_DB_URI = process.env.SECONDARY_DB_URI;

let secondaryConnection;

if (!SECONDARY_DB_URI) {
  console.warn("⚠️ No está definida la variable SECONDARY_DB_URI en el .env");
  // Crear una conexión dummy
  secondaryConnection = {
    model: () => {
      console.warn("⚠️ Usando modelo dummy - SECONDARY_DB_URI no configurada");
      return {
        find: () => Promise.resolve([]),
        findById: () => Promise.resolve(null),
        create: () => Promise.resolve({}),
        findByIdAndUpdate: () => Promise.resolve({}),
        findByIdAndDelete: () => Promise.resolve({})
      };
    }
  };
} else {
  secondaryConnection = mongoose.createConnection(SECONDARY_DB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    dbName: "GrupoProser",
    serverSelectionTimeoutMS: 5000, // 5 segundos
    socketTimeoutMS: 45000, // 45 segundos
    maxPoolSize: 10,
    minPoolSize: 1,
    maxIdleTimeMS: 30000,
    retryWrites: true,
    w: "majority"
  });

  secondaryConnection.on("connected", () => {
    console.log("✅ Conectado a la base de datos secundaria (GrupoProser)");
  });

  secondaryConnection.on("error", (err) => {
    console.error("❌ Error en la conexión secundaria:", err);
    // No lanzar error, solo log
  });

  secondaryConnection.on("disconnected", () => {
    console.log("⚠️ Desconectado de la base de datos secundaria");
  });
}

export default secondaryConnection;
