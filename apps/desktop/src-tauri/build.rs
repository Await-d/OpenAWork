fn main() {
    // 让 cargo 在 sidecars 重新打包后重跑 build.rs。
    // Tauri 默认仅在 build.rs/tauri.conf.json 改动或已知资源文件被修改时
    // 才触发资源复制（见 tauri-apps/tauri#14992）；如果只是新增依赖（例如
    // sidecar 的 node_modules 多了一个包），cargo 不会重跑 build.rs，
    // target/<profile>/sidecars 中就会保留旧副本，导致 dev 模式下 node
    // 进程因缺包立即崩溃，进而触发桌面端"本地 Gateway 健康检查失败"。
    //
    // 通过 bundle-sidecar 写入的标记文件触发，仅追踪一个轻量 stamp，
    // 避免 cargo 递归索引整个 sidecars/node_modules 引发的开销。
    println!("cargo:rerun-if-changed=binaries/.bundle-stamp");
    tauri_build::build()
}
