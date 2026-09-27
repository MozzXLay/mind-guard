use serde::Serialize;

pub type VaultResult<T> = Result<T, VaultError>;

#[derive(Debug, Serialize)]
pub struct VaultError {
    pub code: &'static str,
    pub message: &'static str,
}

impl VaultError {
    pub const fn new(code: &'static str, message: &'static str) -> Self {
        Self { code, message }
    }

    pub const fn io() -> Self {
        Self::new("IO", "本地文件操作未完成，请检查磁盘空间和文件权限。")
    }

    pub const fn crypto() -> Self {
        Self::new("CRYPTO", "加密数据无法验证，请检查密码或备份文件。")
    }

    pub const fn locked() -> Self {
        Self::new("LOCKED", "应用已锁定，请先解锁。")
    }

    pub const fn invalid() -> Self {
        Self::new("VALIDATION", "输入不符合要求，请检查后重试。")
    }

    pub const fn conflict() -> Self {
        Self::new("CONFLICT", "此设备上已有数据，不能覆盖。")
    }

    pub const fn unsupported() -> Self {
        Self::new("UNSUPPORTED", "此数据格式或加密组件暂不受支持。")
    }
}
