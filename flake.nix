{
  description = "dsh-nu development environment";

  # Pinned to the nixpkgs revision that packages the tested Nushell 0.115.1.
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/55ba7f49ef2962b42cbd126522b7df5f95037679";

  outputs = {
    self,
    nixpkgs,
  }: let
    systems = [
      "x86_64-linux"
      "aarch64-linux"
      "x86_64-darwin"
      "aarch64-darwin"
    ];
    forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system);
  in {
    devShells = forAllSystems (system: let
      pkgs = import nixpkgs {inherit system;};
    in {
      default = pkgs.mkShell {
        packages = with pkgs; [
          nodejs_24
          nushell
          git
          gh
          jq
          ripgrep
        ];

        shellHook = ''
          echo "dsh-nu dev shell: node $(node --version), nu $(nu --version)"
          case "$(nu --version)" in
            0.115.1*) ;;
            *) echo "warning: this project is tested with Nushell 0.115.1" >&2 ;;
          esac
        '';
      };
    });

    formatter = forAllSystems (system: nixpkgs.legacyPackages.${system}.nixfmt-rfc-style);
  };
}
