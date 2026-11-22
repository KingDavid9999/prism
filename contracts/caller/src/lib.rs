#![no_std]
//! A companion contract that invokes the showcase from a nested Soroban call.

use prism_showcase::ShowcaseClient;
use soroban_sdk::{contract, contractimpl, Address, Env, String, Symbol};

#[contract]
pub struct Caller;

#[contractimpl]
impl Caller {
    /// Increment the showcase counter through a contract-to-contract call.
    pub fn bump_showcase(env: Env, showcase: Address, by: u32) -> u32 {
        ShowcaseClient::new(&env, &showcase).bump(&by)
    }

    /// Forward the author argument to showcase's require_auth-protected write.
    /// This produces a nested authorization tree for explorer inspection.
    pub fn write_showcase_note(
        env: Env,
        showcase: Address,
        author: Address,
        name: Symbol,
        body: String,
    ) -> u32 {
        ShowcaseClient::new(&env, &showcase).put_note(&author, &name, &body)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use prism_showcase::Showcase;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn nested_calls_update_showcase_and_forward_authorization() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        let showcase = env.register(Showcase, ());
        let showcase_client = ShowcaseClient::new(&env, &showcase);
        let admin = Address::generate(&env);
        showcase_client.init(&admin);
        let caller = env.register(Caller, ());
        let client = CallerClient::new(&env, &caller);
        assert_eq!(client.bump_showcase(&showcase, &7), 7);
        let author = Address::generate(&env);
        let name = Symbol::new(&env, "nested");
        assert_eq!(
            client.write_showcase_note(&showcase, &author, &name, &String::from_str(&env, "hello")),
            1
        );
        assert_eq!(showcase_client.note(&name).author, author);
    }

    #[test]
    fn nested_write_rejects_missing_authorization() {
        let env = Env::default();
        env.mock_all_auths();
        let showcase = env.register(Showcase, ());
        ShowcaseClient::new(&env, &showcase).init(&Address::generate(&env));
        let caller = env.register(Caller, ());
        let client = CallerClient::new(&env, &caller);
        env.mock_auths(&[]);
        assert!(client
            .try_write_showcase_note(
                &showcase,
                &Address::generate(&env),
                &Symbol::new(&env, "auth"),
                &String::from_str(&env, "blocked"),
            )
            .is_err());
    }
}
