module.exports = {
  APP_NAME: "migration-test",
  NAMESPACE: "default",
  ARGOCD_NAMESPACE: "openshift-gitops",
  ARGOCD_SERVER: process.env.ARGOCD_SERVER || "openshift-gitops-server-openshift-gitops.apps-crc.testing",
  ARGOCD_USERNAME: process.env.ARGOCD_USERNAME || "admin",
  ARGOCD_PASSWORD: process.env.ARGOCD_PASSWORD || "",
  PROJECT_DIR: process.cwd(),
};
