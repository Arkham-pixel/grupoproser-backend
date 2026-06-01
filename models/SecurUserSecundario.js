import secondaryConnection from "../db/secondaryConnection.js";
import mongoose from "mongoose";

const SecurUserSchema = new mongoose.Schema({
  login: String,
  pswd: String,
  name: String,
  email: String,
  active: String, // Cambiado de Boolean a String
  activation_code: String,
  priv_admin: Boolean,
  mfa: String, // Cambiado de Boolean a String
  picture: String,
  role: String,
  phone: String,
  pswd_last_updated: Date,
  mfa_last_updated: Date,
  twoFACode: String,
  twoFACodeExpires: Date,
});

export default secondaryConnection.model("securUsers", SecurUserSchema, "securUsers");
// El tercer parámetro fuerza el nombre de la colección
