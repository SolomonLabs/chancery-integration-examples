use std::{error::Error, fmt};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegrationError {
    message: String,
}

impl IntegrationError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for IntegrationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl Error for IntegrationError {}
