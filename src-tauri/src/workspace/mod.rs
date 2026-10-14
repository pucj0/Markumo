pub mod guard;
pub mod ignore;
pub mod search;
pub mod service;

#[cfg(test)]
mod tests;

pub use search::{SearchManager, SearchMatch, SearchQuery, WorkspaceSearcher};
pub use service::{WorkspaceInfo, WorkspaceNode, WorkspaceService};
