pub fn placeholder() -> &'static str {
    "scanner crate — scaffolding OK"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholder_returns_expected_string() {
        assert_eq!(placeholder(), "scanner crate — scaffolding OK");
    }
}
