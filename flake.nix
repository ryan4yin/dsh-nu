{
  description = "dsh-nu: Nushell-only shell bundle for DeepSeek Harness";

  # Pinned to the nixpkgs revision that packages the tested Nushell 0.115.1.
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/55ba7f49ef2962b42cbd126522b7df5f95037679";

  # A packaged dsh, used only by the checks. Consumers pass their own dsh to
  # `mkDshNuPackage`, so this input is not part of the library path.
  inputs.nur-ryan4yin = {
    url = "github:ryan4yin/nur-packages";
    inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = {
    self,
    nixpkgs,
    nur-ryan4yin,
  }: let
    systems = [
      "x86_64-linux"
      "aarch64-linux"
      "x86_64-darwin"
      "aarch64-darwin"
    ];
    forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system);
  in {
    lib = {
      # Build the plugin from this checkout against the dsh installation it
      # plugs into. The caller supplies both, so this flake does not depend on
      # how dsh itself is packaged. Use the result with
      # `dsh.withPlugins [ (dsh-nu.lib.mkDshNuPackage { inherit pkgs dsh; }) ]`.
      mkDshNuPackage = {
        pkgs,
        dsh,
        nushell ? pkgs.nushell,
      }:
        pkgs.callPackage ./nix/dsh-nu.nix {
          inherit dsh nushell;
          src = self.outPath;
        };
    };

    # Build the plugin the way a consumer does, so CI catches a stale
    # npmDepsHash or a dsh layout change. NUR is only the source of a packaged
    # dsh here; the library path above stays source-of-dsh agnostic.
    checks = nixpkgs.lib.genAttrs [
      "x86_64-linux"
      "aarch64-linux"
      "aarch64-darwin"
    ] (system: {
      package = self.lib.mkDshNuPackage {
        pkgs = nixpkgs.legacyPackages.${system};
        dsh = nur-ryan4yin.packages.${system}.dsh;
      };
    });

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
